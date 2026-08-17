/**
 * Age + gender formatting helpers used across the LIMS workflow.
 * Renders compact "36/M" badges next to patient names.
 *
 * Lab/home visits use DOB. Pickup-point visits often have no DOB and store
 * free-text age in `age_text` instead.
 */

export function calcAgeYears(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
  return age;
}

export function shortGender(gender: string | null | undefined): string {
  if (!gender) return "";
  const g = gender.trim().toLowerCase();
  if (g === "male" || g === "m") return "M";
  if (g === "female" || g === "f") return "F";
  return "O";
}

/** Compact age fragment for badges from pickup free-text (`45 Years` → `45`). */
export function compactAgeFromText(ageText: string | null | undefined): string | null {
  const t = String(ageText || "").trim();
  if (!t) return null;
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|m|days?|d)?\b/i);
  if (!m) return t;
  const n = m[1];
  const unit = (m[2] || "").toLowerCase();
  if (!unit || unit.startsWith("y")) return n;
  if (unit.startsWith("mo") || unit === "m") return `${n}m`;
  if (unit.startsWith("d")) return `${n}d`;
  return n;
}

/** Numeric age in years for range matching — DOB first, else pickup age_text years. */
export function patientAgeYears(
  dob?: string | null,
  ageText?: string | null,
): number | null {
  const fromDob = calcAgeYears(dob);
  if (fromDob !== null) return fromDob;
  const compact = compactAgeFromText(ageText);
  if (!compact) return null;
  if (/^\d+(\.\d+)?$/.test(compact)) {
    const n = Number(compact);
    return Number.isFinite(n) ? Math.floor(n) : null;
  }
  // Months/days → treat as under 1 year for adult vs pediatric ranges
  if (/^\d+(\.\d+)?[md]$/i.test(compact)) return 0;
  return null;
}

export function formatAgeGender(
  dob: string | null | undefined,
  gender: string | null | undefined,
  ageText?: string | null,
): string {
  const fromDob = calcAgeYears(dob);
  const age =
    fromDob !== null ? String(fromDob) : compactAgeFromText(ageText);
  const g = shortGender(gender);
  if (age === null && !g) return "—";
  return `${age === null ? "—" : age}/${g || "—"}`;
}
