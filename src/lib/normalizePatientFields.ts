/** Canonical titles used by LIMS registration selects. */
export const PATIENT_TITLES = [
  "Mr.",
  "Mrs.",
  "Ms.",
  "Master",
  "Miss",
  "Baby Of",
  "Dr.",
  "M. S.",
  "S. S.",
] as const;

/** Titles with trailing period variants used by some home-visit dialogs. */
export const PATIENT_TITLES_DOTTED = [
  "Mr.",
  "Mrs.",
  "Ms.",
  "Miss.",
  "Master.",
  "Baby Of.",
  "Dr.",
  "M. S.",
  "S. S.",
] as const;

/** Map legacy / messy title strings (e.g. MR., MRS) onto the registration select. */
export function normalizeTitle(raw: string | null | undefined): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Initials with a period after the first letter (must run before "ms" -> Ms.)
  if (/^m\.\s*s\.?$/i.test(t)) return "M. S.";
  if (/^s\.\s*s\.?$/i.test(t)) return "S. S.";
  const compact = t.replace(/\./g, "").replace(/\s+/g, "").toLowerCase();
  const aliases: Record<string, string> = {
    mr: "Mr.",
    shri: "Mr.",
    mrs: "Mrs.",
    smt: "Mrs.",
    ms: "Ms.",
    miss: "Miss",
    master: "Master",
    baby: "Baby Of",
    babyof: "Baby Of",
    dr: "Dr.",
    doctor: "Dr.",
  };
  if (aliases[compact]) return aliases[compact];
  const exact = PATIENT_TITLES.find(
    (x) => x.toLowerCase() === t.toLowerCase() || x.replace(/\./g, "").replace(/\s+/g, "").toLowerCase() === compact,
  );
  return exact || "";
}

/** Auto gender from title. Empty string = leave / ask (Dr., Baby Of). */
export function genderFromTitle(raw: string | null | undefined): "Male" | "Female" | "" {
  const normalized = normalizeTitle(raw);
  const t = normalized || String(raw ?? "").replace(/\s+/g, " ").trim();
  if (t === "Mr." || t === "Master" || t === "Master." || t === "M. S.") return "Male";
  if (t === "Mrs." || t === "Ms." || t === "Miss" || t === "Miss." || t === "S. S.") return "Female";
  return "";
}

export function normalizeGender(raw: string | null | undefined): string {
  const g = String(raw ?? "").trim().toLowerCase();
  if (!g) return "";
  if (g === "m" || g === "male" || g.startsWith("male")) return "Male";
  if (g === "f" || g === "female" || g.startsWith("female")) return "Female";
  if (g.startsWith("u") || g === "other") return "Unspecified";
  return "";
}

/** HTML date inputs require yyyy-mm-dd. */
export function toDateInputValue(raw: string | null | undefined): string {
  if (raw == null) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) {
    return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  return "";
}

/** yyyy-mm-dd -> dd-mm-yyyy without timezone shifts. */
export function isoToDmy(raw: string | null | undefined): string {
  const iso = toDateInputValue(raw);
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

/** Type DOB as dd-mm-yyyy. `iso` is set only when the full date is valid. */
export function maskDmyDob(raw: string): { display: string; iso: string } {
  const digits = String(raw || "").replace(/\D/g, "").slice(0, 8);
  let display = digits;
  if (digits.length >= 4) display = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
  else if (digits.length >= 2) display = `${digits.slice(0, 2)}-${digits.slice(2)}`;

  let iso = "";
  if (digits.length === 8) {
    const dd = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2, 4));
    const yyyy = Number(digits.slice(4, 8));
    const parsed = new Date(yyyy, mm - 1, dd);
    if (
      yyyy >= 1900 &&
      parsed.getFullYear() === yyyy &&
      parsed.getMonth() === mm - 1 &&
      parsed.getDate() === dd &&
      parsed.getTime() <= Date.now()
    ) {
      iso = `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
    }
  }
  return { display, iso };
}
