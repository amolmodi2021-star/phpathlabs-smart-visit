/**
 * Display age for invoices/reports.
 *
 * - Pickup: free-text `ageText` (no DOB).
 * - Lab/home: derive from DOB.
 * - `asOf` freezes age at approval/registration time so reprints years later
 *   still show the age from when the report was approved.
 */
export function formatPatientAge(opts: {
  dob?: string | null;
  ageText?: string | null;
  /** Anchor date for DOB→age (approval_date preferred). Defaults to now. */
  asOf?: string | Date | null;
}): string {
  const text = String(opts.ageText || "").trim();
  if (text) {
    if (/^\d+(\.\d+)?$/.test(text)) return `${text} Years`;
    return text;
  }
  const dob = opts.dob;
  if (!dob) return "—";
  try {
    const birth = new Date(dob);
    if (Number.isNaN(birth.getTime())) return "—";
    const asOfRaw = opts.asOf;
    const now =
      asOfRaw == null || asOfRaw === ""
        ? new Date()
        : asOfRaw instanceof Date
          ? asOfRaw
          : new Date(asOfRaw);
    if (Number.isNaN(now.getTime())) return "—";
    let years = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
    if (years < 1) {
      const months =
        (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
      return `${Math.max(0, months)} months`;
    }
    return `${years} Years`;
  } catch {
    return "—";
  }
}

/** Age string to freeze onto approved_reports at approval time. */
export function snapshotAgeAtApproval(reg: {
  visit_type?: string | null;
  dob?: string | null;
  age_text?: string | null;
}, approvalIso: string): string | null {
  if (reg.visit_type === "pickup_point") {
    const t = String(reg.age_text || "").trim();
    return t || null;
  }
  const age = formatPatientAge({ dob: reg.dob, asOf: approvalIso });
  return age === "—" ? null : age;
}

/**
 * Report PDF age source: keep the frozen approval snapshot when present.
 * If the snapshot was never stored (older pickup approvals omitted age_text
 * from the doctor-approval query), fall back to the live registration value.
 * Used by both final and provisional report PDFs.
 */
export function resolveReportAgeText(
  snapshotAgeText?: string | null,
  liveAgeText?: string | null,
): string | null {
  const frozen = String(snapshotAgeText || "").trim();
  if (frozen) return frozen;
  const live = String(liveAgeText || "").trim();
  return live || null;
}