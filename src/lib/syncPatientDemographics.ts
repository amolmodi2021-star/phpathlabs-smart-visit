import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Patient demographic fan-out.
 *
 * When a user edits a patient's demographics (name, DOB, gender, mobile, etc.)
 * from the Registered Section, we propagate the change to every table that
 * holds a denormalized copy — keyed by UMR so ALL historical visits of the
 * same patient get the corrected details, not just the current invoice.
 *
 * Audit-trail tables (abnormal_history, payment_transactions,
 * pickup_point_invoice_items) are intentionally NOT touched — they are
 * immutable records of what was sent / paid at that moment in time.
 */

export interface PatientDemographics {
  umr_number?: string | null;
  patient_name: string;
  title?: string | null;
  gender?: string | null;
  dob?: string | null;
  email?: string | null;
  mobile_number?: string | null;
  address?: string | null;
  doctor_name?: string | null;
}

/**
 * Update every table holding a copy of this patient's demographics, matched
 * by UMR. If UMR is missing, this is a no-op (avoid accidentally touching
 * unrelated rows). The current `patient_registrations` row should already
 * have been updated by the caller.
 *
 * Errors in any individual sub-update are swallowed (logged to console) so a
 * missing CRM row or absent loyalty card doesn't fail the whole save.
 */
export async function syncPatientDemographicsByUmr(
  currentRegistrationId: string,
  demo: PatientDemographics,
): Promise<{ ok: boolean; warnings: string[] }> {
  const umr = (demo.umr_number || "").trim();
  const warnings: string[] = [];
  if (!umr) {
    return { ok: true, warnings: ["No UMR — skipped cross-table sync."] };
  }

  // 1. Sister visits in patient_registrations (same UMR, different invoice)
  const sisterRegs = supabase
    .from("patient_registrations")
    .update({
      patient_name: demo.patient_name,
      title: demo.title ?? null,
      gender: demo.gender ?? null,
      dob: demo.dob ?? null,
      email: demo.email ?? null,
      doctor_name: demo.doctor_name ?? "SELF",
      address: demo.address ?? null,
      mobile_number: demo.mobile_number ?? null,
    } as any)
    .eq("umr_number", umr)
    .neq("id", currentRegistrationId);

  // 2. Approved report snapshots — patient demographics only.
  //    Clinical content (test_results, signatures) stays untouched.
  const approved = supabase
    .from("approved_reports")
    .update({
      patient_name: demo.patient_name,
      title: demo.title ?? null,
      gender: demo.gender ?? null,
      dob: demo.dob ?? null,
      email: demo.email ?? null,
      doctor_name: demo.doctor_name ?? null,
      address: demo.address ?? null,
      mobile_number: demo.mobile_number ?? null,
    } as any)
    .eq("umr_number", umr);

  // 3. CRM contacts removed (CRM module disabled — cost optimization 2026-04-28)

  // 4. Patient master — umr_id is the column name. Title + address now live here too.
  const master = supabase
    .from("patient_master")
    .update({
      patient_name: demo.patient_name,
      title: demo.title ?? null,
      gender: demo.gender ?? null,
      mobile_number: demo.mobile_number ?? null,
      email: demo.email ?? null,
      date_of_birth: demo.dob ?? null,
      address: demo.address ?? null,
    } as any)
    .eq("umr_id", umr);

  // 5. Estimates — same UMR
  const estimates = supabase
    .from("estimates")
    .update({
      patient_name: demo.patient_name,
      title: demo.title ?? null,
      gender: demo.gender ?? null,
      dob: demo.dob ?? null,
      email: demo.email ?? null,
      doctor_name: demo.doctor_name ?? "SELF",
    } as any)
    .eq("umr_number", umr);

  // 6. LIMS test orders — keyed by sample_id (= invoice number prefix).
  //    Pull all invoices belonging to this UMR first, then update by IN clause.
  const ordersUpdate = (async () => {
    const { data: regs } = await supabase
      .from("patient_registrations")
      .select("invoice_number")
      .eq("umr_number", umr);
    const invoices = (regs || []).map((r: any) => r.invoice_number).filter(Boolean);
    if (invoices.length === 0) return { error: null };
    return supabase
      .from("lims_test_orders")
      .update({ patient_name: demo.patient_name } as any)
      .in("sample_id", invoices);
  })();

  const results = await Promise.allSettled([
    sisterRegs, approved, master, estimates, ordersUpdate,
  ]);
  const labels = [
    "patient_registrations (sister visits)",
    "approved_reports",
    "patient_master",
    "estimates",
    "lims_test_orders",
  ];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      warnings.push(`${labels[i]}: ${String(r.reason)}`);
      // eslint-disable-next-line no-console
      console.warn(`[syncPatientDemographics] ${labels[i]} failed`, r.reason);
    } else if ((r.value as any)?.error) {
      warnings.push(`${labels[i]}: ${(r.value as any).error.message}`);
      // eslint-disable-next-line no-console
      console.warn(`[syncPatientDemographics] ${labels[i]} error`, (r.value as any).error);
    }
  });

  return { ok: warnings.length === 0, warnings };
}

/**
 * Invalidate every React Query key that depends on patient demographics so
 * the UI refreshes instantly across all open modules and tabs.
 */
export function invalidatePatientCaches(qc: QueryClient): void {
  const keys = [
    "patient_registrations",
    "registered_patients",
    "dispatch_regs",
    "dispatch_regs_count",
    "dispatch_all_results",
    "sample_collection_regs",
    "sample_tubes_collection",
    "sample_tubes_acceptance_pending",
    "sample_tubes_acceptance_accepted",
    "results_entry_regs",
    "verification_regs",
    "doctor_approval_regs",
    "modified_approval_regs",
    "due_payments",
    "bad_debts",
    "approved_reports",
    "lims_report_view",
    "patient_master",
    "estimates",
  ];
  keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
}
