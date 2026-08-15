/**
 * Outsourced results are exclusive: typed parameter values OR a snipped image,
 * never both. Tests without parameter setup are snip-only by default.
 */

export type OutsourcedResultMode = "manual" | "snip";

export function snipImageUrlsFromRow(snip: {
  snip_image_urls?: unknown;
  snip_image_url?: string | null;
} | null | undefined): string[] {
  if (!snip) return [];
  if (Array.isArray(snip.snip_image_urls) && snip.snip_image_urls.length > 0) {
    return snip.snip_image_urls.filter((u): u is string => typeof u === "string" && u.length > 0);
  }
  if (snip.snip_image_url) return [snip.snip_image_url];
  return [];
}

/** True when this outsourced row is saved as a snipped-image result. */
export function isSnipResultRow(snip: {
  result_mode?: string | null;
  snip_image_urls?: unknown;
  snip_image_url?: string | null;
} | null | undefined): boolean {
  if (!snip || snip.result_mode !== "snip") return false;
  return snipImageUrlsFromRow(snip).length > 0;
}

/** UI/detail-map shape used by Results / Verification / Approval. */
export function isSnipResultDetail(detail: {
  resultMode?: string | null;
  snipImageUrls?: unknown;
} | null | undefined): boolean {
  if (!detail || detail.resultMode !== "snip") return false;
  return Array.isArray(detail.snipImageUrls) && detail.snipImageUrls.length > 0;
}
