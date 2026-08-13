/**
 * Display age for invoices/reports.
 * Pickup-point registrations store free-text `age_text` (no DOB).
 * Lab/home visits use DOB → years/months.
 */
export function formatPatientAge(opts: {
  dob?: string | null;
  ageText?: string | null;
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
    const now = new Date();
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