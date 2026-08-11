/** Shared age/gender normal-range helpers for Results UI and report rendering. */

export type NormalRangeRow = {
  parameter_id?: string;
  gender?: string | null;
  age_min?: number | null;
  age_max?: number | null;
  range_type?: string | null;
  normal_range_text?: string | null;
  normal_range_low?: number | null;
  normal_range_high?: number | null;
  normal_findings?: string | null;
  expected_value?: string | null;
  descriptive_options?: string[] | null;
};

/** Build display text: prefer stored text, else low-high / one-sided bounds. */
export function formatNormalRangeDisplayText(
  row: Pick<NormalRangeRow, "normal_range_text" | "normal_range_low" | "normal_range_high"> | null | undefined,
  unit?: string | null,
): string {
  if (!row) return "";
  const text = String(row.normal_range_text ?? "").trim();
  if (text) return text;
  const low = row.normal_range_low;
  const high = row.normal_range_high;
  const u = String(unit ?? "").trim();
  const suffix = u ? ` ${u}` : "";
  if (low != null && high != null) return `${low} - ${high}${suffix}`;
  if (high != null && low == null) return `< ${high}${suffix}`;
  if (low != null && high == null) return `> ${low}${suffix}`;
  return "";
}

export function patientAgeYearsFromDob(dob: string | null | undefined, asOf: Date = new Date()): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  return Math.floor((asOf.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
}

/** Pick best age/gender row (same rules as Results / Verification). */
export function pickBestNormalRange(
  ranges: NormalRangeRow[] | null | undefined,
  opts: { gender?: string | null; dob?: string | null; ageYears?: number | null } = {},
): NormalRangeRow | null {
  if (!ranges || ranges.length === 0) return null;
  const patientGender = String(opts.gender || "").toLowerCase().charAt(0);
  const patientAge =
    opts.ageYears != null && !Number.isNaN(opts.ageYears)
      ? opts.ageYears
      : patientAgeYearsFromDob(opts.dob);

  let candidates = ranges.filter((r) => {
    const g = String(r.gender || "all").toLowerCase();
    return g === "all" || (g === "male" && patientGender === "m") || (g === "female" && patientGender === "f");
  });
  if (patientAge != null) {
    const ageMatched = candidates.filter((r) => {
      if (r.age_min == null && r.age_max == null) return true;
      if (r.age_min != null && patientAge < r.age_min) return false;
      if (r.age_max != null && patientAge > r.age_max) return false;
      return true;
    });
    if (ageMatched.length > 0) candidates = ageMatched;
  }
  return candidates.find((r) => String(r.gender || "all").toLowerCase() !== "all") || candidates[0] || null;
}

export function resolveNormalRangeDisplay(
  ranges: NormalRangeRow[] | null | undefined,
  opts: { gender?: string | null; dob?: string | null; unit?: string | null } = {},
): { text: string; low: number | null; high: number | null; rangeType: string; row: NormalRangeRow | null } {
  const best = pickBestNormalRange(ranges, opts);
  if (!best) {
    return { text: "", low: null, high: null, rangeType: "numeric", row: null };
  }
  return {
    text: formatNormalRangeDisplayText(best, opts.unit),
    low: best.normal_range_low ?? null,
    high: best.normal_range_high ?? null,
    rangeType: best.range_type || "numeric",
    row: best,
  };
}
