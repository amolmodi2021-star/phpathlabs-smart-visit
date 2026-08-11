/** Shared LIMS list page-size prefs (egress control). */

export const LIMS_PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;
export type LimsPageSize = (typeof LIMS_PAGE_SIZE_OPTIONS)[number];

const STORAGE_KEY = "lims_list_page_size";

export function readLimsPageSize(fallback: LimsPageSize = 10): LimsPageSize {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = Number(raw);
    if ((LIMS_PAGE_SIZE_OPTIONS as readonly number[]).includes(n)) return n as LimsPageSize;
  } catch {
    /* ignore */
  }
  return fallback;
}

export function writeLimsPageSize(size: LimsPageSize) {
  try {
    localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    /* ignore */
  }
}

/** Map registration.status → coarse Dispatch list dot (no patient_results fetch). */
export function dispatchDotFromRegStatus(
  status: string | null | undefined,
): "all_dispatched" | "all_done" | "partial" | "all_pending" | "cancelled" {
  const s = String(status || "").toLowerCase();
  if (s === "cancelled" || s === "bill_cancelled") return "cancelled";
  if (s === "dispatched") return "all_dispatched";
  if (s === "approved" || s === "partially_approved") return "all_done";
  if (
    s.includes("partial") ||
    s === "verified" ||
    s === "processed" ||
    s === "sample_accepted" ||
    s === "partially_dispatched"
  ) {
    return "partial";
  }
  return "all_pending";
}
