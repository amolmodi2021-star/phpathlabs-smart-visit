/**
 * Always display patient names with title (Mr./Mrs./Ms./etc.).
 * Prefer stored title; fall back to gender when title is missing.
 * Avoids double-prefix if the name already starts with a title.
 */

import { normalizeGender, normalizeTitle, PATIENT_TITLES } from "@/lib/normalizePatientFields";

const KNOWN_TITLES = [...PATIENT_TITLES, "Master.", "Miss.", "Baby Of."];

export type PatientNameFields = {
  title?: string | null;
  patient_name?: string | null;
  gender?: string | null;
};

export function formatPatientDisplayName(
  title: string | null | undefined,
  patientName: string | null | undefined,
  gender?: string | null,
): string {
  const name = (patientName || "").trim();
  if (!name) return "—";

  const nameAlreadyTitled = KNOWN_TITLES.some((t) => {
    const prefix = t.replace(/\.$/, "");
    return new RegExp(`^${prefix}\\.?\\s`, "i").test(name);
  });
  if (nameAlreadyTitled) return name;

  let resolved = normalizeTitle(title);
  if (!resolved) {
    const g = normalizeGender(gender);
    if (g === "Male") resolved = "Mr.";
    else if (g === "Female") resolved = "Mrs.";
  }
  if (!resolved) return name;

  return `${resolved} ${name}`.replace(/\s+/g, " ").trim();
}

/** Convenience for registration / estimate / report row objects. */
export function patientDisplayName(
  patient: PatientNameFields | null | undefined,
): string {
  if (!patient) return "—";
  return formatPatientDisplayName(patient.title, patient.patient_name, patient.gender);
}