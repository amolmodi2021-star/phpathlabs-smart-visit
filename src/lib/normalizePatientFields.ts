/** Canonical titles used by LIMS registration selects. */
export const PATIENT_TITLES = ["Mr.", "Mrs.", "Ms.", "Master", "Miss", "Baby Of", "Dr."] as const;

/** Map legacy / messy title strings (e.g. MR., MRS) onto the registration select. */
export function normalizeTitle(raw: string | null | undefined): string {
  const t = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "";
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
