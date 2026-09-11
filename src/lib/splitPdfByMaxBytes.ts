import { PDFDocument } from "pdf-lib";

/** Cloudinary Free max image/raw upload is 10 MB — stay under with headroom. */
export const CLOUDINARY_SAFE_UPLOAD_BYTES = 9 * 1024 * 1024;

async function buildPart(
  src: PDFDocument,
  start: number,
  endExclusive: number,
): Promise<Blob> {
  const doc = await PDFDocument.create();
  const indices = Array.from({ length: endExclusive - start }, (_, i) => start + i);
  const pages = await doc.copyPages(src, indices);
  for (const p of pages) doc.addPage(p);
  // Preserve embedded JPEG streams as-is (no re-encode / quality change).
  const bytes = await doc.save({ useObjectStreams: false });
  return new Blob([bytes], { type: "application/pdf" });
}

/**
 * Split a multi-page PDF into blobs each <= maxBytes.
 * Page image quality is unchanged (copyPages only).
 * If a single page exceeds maxBytes, that page is still emitted alone.
 */
export async function splitPdfBlobUnderMaxBytes(
  blob: Blob,
  maxBytes: number = CLOUDINARY_SAFE_UPLOAD_BYTES,
): Promise<Blob[]> {
  if (!(blob instanceof Blob) || blob.size <= 0) return [blob];
  if (blob.size <= maxBytes) return [blob];

  const src = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  if (pageCount <= 1) return [blob];

  const avg = blob.size / pageCount;
  let guess = Math.max(1, Math.floor((maxBytes / avg) * 0.9));
  guess = Math.min(pageCount, Math.max(1, guess));

  const parts: Blob[] = [];
  let start = 0;
  while (start < pageCount) {
    let end = Math.min(pageCount, start + guess);
    let part = await buildPart(src, start, end);
    while (part.size > maxBytes && end - start > 1) {
      end -= 1;
      part = await buildPart(src, start, end);
    }
    parts.push(part);
    const used = end - start;
    // Adapt guess from this part for remaining pages.
    if (part.size > 0) {
      const nextGuess = Math.max(1, Math.floor(used * (maxBytes / part.size) * 0.9));
      guess = Math.min(pageCount - end, Math.max(1, nextGuess));
    }
    start = end;
  }
  return parts;
}