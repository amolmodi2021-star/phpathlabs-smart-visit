/**
 * Age + gender formatting helpers used across the LIMS workflow.
 * Renders compact "36/M" badges next to patient names.
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

export function formatAgeGender(
  dob: string | null | undefined,
  gender: string | null | undefined,
): string {
  const age = calcAgeYears(dob);
  const g = shortGender(gender);
  if (age === null && !g) return "—";
  return `${age === null ? "—" : age}/${g || "—"}`;
}
