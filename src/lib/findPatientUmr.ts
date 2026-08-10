import { supabase } from "@/integrations/supabase/client";

export type MasterPatientMatch = {
  id: string;
  umr_id: string;
  patient_name: string;
  title: string | null;
  gender: string | null;
  date_of_birth: string | null;
  email: string | null;
  address: string | null;
  mobile_number: string | null;
  last_visit_date: string | null;
};

function mobile10(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "").slice(-10);
}

/** All patient_master rows on this mobile (same number can have several UMRs). */
export async function findPatientMasterByMobile(
  mobile: string | null | undefined,
): Promise<MasterPatientMatch[]> {
  const digits = mobile10(mobile);
  if (digits.length !== 10) return [];

  const { data, error } = await supabase
    .from("patient_master")
    .select("id, umr_id, patient_name, title, gender, date_of_birth, email, address, mobile_number, last_visit_date")
    .or(`mobile_number.eq.${digits},mobile_number.ilike.%${digits}`)
    .order("last_visit_date", { ascending: false, nullsFirst: false });
  if (error) throw error;

  const seen = new Set<string>();
  const rows: MasterPatientMatch[] = [];
  for (const row of (data || []) as MasterPatientMatch[]) {
    const umr = String(row.umr_id || "").trim();
    if (!umr || seen.has(umr)) continue;
    seen.add(umr);
    rows.push(row);
  }
  return rows;
}

export type HomeVisitPatientLink = {
  linked_umr_number?: string | null;
  register_as_new_patient?: boolean | null;
};

/**
 * UMR to pass into register_patient_atomic.
 * null  → new patient, allocate at save (locked in generate_umr_number).
 * string → existing LIMS UMR chosen at Complete Missing Details.
 */
export function umrForHomeVisitRegistration(visit: HomeVisitPatientLink | null | undefined): string | null {
  if (visit?.register_as_new_patient) return null;
  const linked = String(visit?.linked_umr_number || "").trim();
  return linked || null;
}

export function homeVisitHasPatientChoice(visit: HomeVisitPatientLink | null | undefined): boolean {
  if (!visit) return false;
  if (visit.register_as_new_patient) return true;
  return !!String(visit.linked_umr_number || "").trim();
}
