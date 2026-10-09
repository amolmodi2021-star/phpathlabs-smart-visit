import { supabase } from "@/integrations/supabase/client";
import {
  buildDoctorOnePagerInput,
  normalizeDoctorOnePagerSummary,
  type DoctorOnePagerSummary,
  type OnePagerResult,
  type PriorVisit,
} from "@/lib/doctorOnePagerGroups";

function visitDate(row: any): string {
  const iso = row.sample_collection_date || row.approval_date || row.registration_date || row.created_at || "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function rowsFromSnapshot(testResults: unknown): OnePagerResult[] {
  const list = Array.isArray(testResults) ? testResults : [];
  return list
    .filter((row: any) => row && (row.parameter_name || row.param_code) && String(row.result_value ?? "").trim())
    .map((row: any) => ({
      test_id: row.test_id,
      test_name: row.test_name,
      parameter_id: row.parameter_id,
      parameter_name: row.parameter_name,
      param_code: row.param_code,
      result_value: row.result_value,
      unit: row.unit,
      reference_range: row.reference_range,
      flag: row.flag,
    }));
}

export async function loadPriorVisitsForOnePager(
  umrNumber: string | null | undefined,
  registrationId: string | null | undefined,
): Promise<PriorVisit[]> {
  const umr = String(umrNumber || "").trim();
  if (!umr) return [];
  const { data, error } = await supabase
    .from("approved_reports")
    .select("registration_id, invoice_number, approval_date, sample_collection_date, registration_date, created_at, test_results")
    .eq("umr_number", umr)
    .order("approval_date", { ascending: false })
    .limit(8);
  if (error) throw error;
  return (data || [])
    .filter((row: any) => row.registration_id !== registrationId)
    .slice(0, 4)
    .map((row: any) => ({
      date: visitDate(row),
      invoice: row.invoice_number,
      results: rowsFromSnapshot(row.test_results),
    }));
}

export async function requestDoctorOnePager(opts: {
  current: OnePagerResult[];
  priorVisits: PriorVisit[];
}): Promise<DoctorOnePagerSummary> {
  const payload = buildDoctorOnePagerInput(opts);
  if (payload.groups.length === 0 && payload.ungrouped_abnormal.length === 0) {
    return normalizeDoctorOnePagerSummary({
      overall_clinical_snapshot: "No reportable laboratory values were available to summarise.",
      clinical_patterns: [],
      points_for_clinical_review: [],
    });
  }
  const { data, error } = await supabase.functions.invoke("doctor-one-pager", { body: payload });
  if (data?.error) throw new Error(String(data.error));
  if (error) {
    const ctx = (error as any)?.context;
    let detail = "";
    try {
      if (ctx && typeof ctx.json === "function") {
        const body = await ctx.json();
        detail = body?.error || "";
      }
    } catch {
      detail = "";
    }
    throw new Error(detail || error.message || "Doctor summary failed");
  }
  return normalizeDoctorOnePagerSummary(data);
}