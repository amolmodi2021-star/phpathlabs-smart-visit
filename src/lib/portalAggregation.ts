import { supabase } from "@/integrations/supabase/client";

/**
 * Fetch all non-cancelled patient_registrations for the same UMR + same calendar date
 * (based on created_at). Returns rows ordered by created_at ascending.
 */
export async function fetchSiblingRegistrations(
  umrNumber: string | null | undefined,
  isoDate: string,
): Promise<any[]> {
  if (!umrNumber) return [];
  // Compute UTC day boundaries from the registration's created_at.
  const ref = new Date(isoDate);
  if (isNaN(ref.getTime())) return [];
  const dayStart = new Date(ref);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const { data, error } = await supabase
    .from("patient_registrations")
    .select(
      "id, invoice_number, patient_name, mobile_number, umr_number, dob, due_amount, paid_amount, final_amount, created_at, tests, cancelled_tests, status, bill_cancelled",
    )
    .eq("umr_number", umrNumber)
    .gte("created_at", dayStart.toISOString())
    .lt("created_at", dayEnd.toISOString())
    .order("created_at", { ascending: true });
  if (error) {
    console.warn("fetchSiblingRegistrations failed", error);
    return [];
  }
  return (data || []).filter((r: any) => !r.bill_cancelled);
}

/**
 * Build a map of test_id -> department_name by joining tests with report_departments.
 * Returns { [testId]: departmentName }. Tests without a department are omitted.
 * Also returns deptOrder map for sorting (display_order).
 */
export async function fetchDepartmentMap(): Promise<{
  testDept: Record<string, string>;
  deptOrder: Record<string, number>;
}> {
  const [{ data: tests }, { data: depts }] = await Promise.all([
    supabase.from("tests").select("id, department_id"),
    supabase.from("report_departments").select("id, department_name, display_order"),
  ]);
  const deptName: Record<string, string> = {};
  const deptOrder: Record<string, number> = {};
  (depts || []).forEach((d: any) => {
    deptName[d.id] = d.department_name;
    deptOrder[d.department_name] = d.display_order ?? 999;
  });
  const testDept: Record<string, string> = {};
  (tests || []).forEach((t: any) => {
    if (t.department_id && deptName[t.department_id]) {
      testDept[t.id] = deptName[t.department_id];
    }
  });
  return { testDept, deptOrder };
}

/**
 * Abnormal history fetch DISABLED — CRM tables are dropped/unused
 * (cost optimization 2026-04-28). Returns empty grouping so the patient
 * report portal renders cleanly without an "abnormal history" section.
 */
export async function fetchAbnormalForUmr(_umrNumber: string | null | undefined) {
  return {} as Record<string, any[]>;
}

/**
 * Fetch previously approved reports for a UMR, excluding the current aggregated registration ids.
 */
export async function fetchPreviousApprovedReports(
  umrNumber: string | null | undefined,
  excludeRegistrationIds: string[],
  limit = 20,
) {
  if (!umrNumber) return [];
  let query = supabase
    .from("approved_reports")
    .select(
      "id, registration_id, invoice_number, patient_name, registration_date, approval_date, test_results",
    )
    .eq("umr_number", umrNumber)
    .order("approval_date", { ascending: false })
    .limit(limit * 4); // overfetch then dedupe by registration_id
  const { data } = await query;
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of data || []) {
    if (excludeRegistrationIds.includes(r.registration_id)) continue;
    if (seen.has(r.registration_id)) continue;
    seen.add(r.registration_id);
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
