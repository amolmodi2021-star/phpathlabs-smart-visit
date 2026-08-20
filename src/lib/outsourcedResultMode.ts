/**
 * Outsourced results may include typed parameter values and/or a composed
 * lab PDF (cropped regions on letterhead). Legacy snip images still render
 * when present on older rows.
 */

export type OutsourcedResultMode = "manual" | "snip" | "pdf";

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

export function composedPdfUrlFromRow(snip: {
  composed_pdf_url?: string | null;
} | null | undefined): string | null {
  const u = snip?.composed_pdf_url;
  return typeof u === "string" && u.length > 0 ? u : null;
}

/** True when this outsourced row has at least one snipped image (any result_mode). */
export function hasOutsourcedSnipImages(snip: {
  result_mode?: string | null;
  snip_image_urls?: unknown;
  snip_image_url?: string | null;
} | null | undefined): boolean {
  return snipImageUrlsFromRow(snip).length > 0;
}

export function hasOutsourcedPdfArtifact(snip: {
  composed_pdf_url?: string | null;
  snip_image_urls?: unknown;
  snip_image_url?: string | null;
} | null | undefined): boolean {
  return !!composedPdfUrlFromRow(snip) || hasOutsourcedSnipImages(snip);
}

/**
 * True when outsourced visual artifact should appear on reports.
 * Prefer composed PDF; fall back to legacy snip images.
 */
export function isSnipResultRow(snip: {
  result_mode?: string | null;
  snip_image_urls?: unknown;
  snip_image_url?: string | null;
  composed_pdf_url?: string | null;
} | null | undefined): boolean {
  return hasOutsourcedPdfArtifact(snip);
}

/** UI/detail-map shape used by Results / Verification / Approval. */
export function isSnipResultDetail(detail: {
  resultMode?: string | null;
  snipImageUrls?: unknown;
  composedPdfUrl?: string | null;
} | null | undefined): boolean {
  if (!detail) return false;
  if (detail.composedPdfUrl) return true;
  return Array.isArray(detail.snipImageUrls) && detail.snipImageUrls.length > 0;
}

/** @deprecated Prefer keeping typed results when adding snips; kept for explicit clears only. */
export async function clearTypedOutsourcedResults(
  client: { from: (table: string) => any },
  regId: string,
  testId: string,
  outsourcedParamIds?: string[],
) {
  let q = client.from("patient_results")
    .delete()
    .eq("registration_id", regId)
    .eq("test_id", testId)
    .in("status", ["pending", "entered", "results_entered"]);
  if (outsourcedParamIds && outsourcedParamIds.length > 0) {
    q = q.in("parameter_id", outsourcedParamIds);
  }
  const { error } = await q;
  if (error) throw error;
}

export async function appendOutsourcedSnipImage(
  client: { from: (table: string) => any; storage: { from: (bucket: string) => any } },
  regId: string,
  testId: string,
  file: File,
  existingUrls: string[],
  _outsourcedParamIds?: string[],
): Promise<string[]> {
  const ext = (file.name.split(".").pop() || "png").replace(/[^a-zA-Z0-9]/g, "") || "png";
  const fileName = `${regId}_${testId}_${Date.now()}.${ext}`;
  const { error: uploadError } = await client.storage
    .from("outsourced-snips")
    .upload(fileName, file, { contentType: file.type || "image/png", upsert: true });
  if (uploadError) throw uploadError;
  const { data: urlData } = client.storage.from("outsourced-snips").getPublicUrl(fileName);
  const newUrls = [...existingUrls, urlData.publicUrl];
  const { error: upsertErr } = await client.from("outsourced_test_snips").upsert({
    registration_id: regId,
    test_id: testId,
    snip_image_url: newUrls[0],
    snip_image_urls: newUrls,
    result_mode: "snip",
    outsource_status: "sent",
  }, { onConflict: "registration_id,test_id" });
  if (upsertErr) throw upsertErr;
  // Keep typed patient_results — snips and parameters may both appear on reports.
  return newUrls;
}
