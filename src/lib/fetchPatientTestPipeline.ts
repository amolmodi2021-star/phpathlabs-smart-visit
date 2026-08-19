/**
 * Lean on-demand fetch for patient test pipeline hover (egress-aware).
 * Prefer single RPC; fall back to multi-query build if RPC unavailable.
 */
import { supabase } from "@/integrations/supabase/client";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import {
  buildPipelineOverview,
  type PipelineTestRow,
  type PipelineTestStatus,
} from "@/lib/testPipelineStatus";

const REG_SELECT = "id, tests, cancelled_tests, repeat_tests, bill_cancelled";
const TUBE_SELECT = "test_ids, status";
const RESULT_SELECT = "test_id, status";
const SNIP_SELECT = "test_id, outsource_status, result_mode, snip_image_urls";

function mapRpcRows(data: unknown): PipelineTestRow[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((r: any) => ({
      testId: String(r.test_id || ""),
      testName: String(r.test_name || "Unknown"),
      status: String(r.status || "registered") as PipelineTestStatus,
    }))
    .filter((r) => !!r.testId);
}

/** Legacy multi-query path (kept as fallback). */
async function fetchPatientTestPipelineLegacy(registrationId: string): Promise<PipelineTestRow[]> {
  const [{ data: reg, error: regErr }, { data: tubes, error: tubeErr }, { data: results, error: resErr }, { data: snips, error: snipErr }] =
    await Promise.all([
      supabase.from("patient_registrations").select(REG_SELECT).eq("id", registrationId).maybeSingle(),
      supabase.from("sample_tubes").select(TUBE_SELECT).eq("registration_id", registrationId),
      supabase.from("patient_results").select(RESULT_SELECT).eq("registration_id", registrationId),
      supabase.from("outsourced_test_snips").select(SNIP_SELECT).eq("registration_id", registrationId),
    ]);

  if (regErr) throw regErr;
  if (tubeErr) throw tubeErr;
  if (resErr) throw resErr;
  if (snipErr) throw snipErr;
  if (!reg) return [];

  const leafIds = new Set<string>();
  for (const tb of tubes || []) {
    for (const id of Array.isArray(tb.test_ids) ? tb.test_ids : []) {
      if (id) leafIds.add(id);
    }
  }
  for (const t of Array.isArray((reg as any).tests) ? (reg as any).tests : []) {
    if (t?.test_id) leafIds.add(t.test_id);
  }

  const leafIdList = [...leafIds];
  let testsMap: Record<string, { test_name?: string | null; is_outsourced?: boolean | null }> = {};
  if (leafIdList.length > 0) {
    const { data: tests, error: tErr } = await supabase
      .from("tests")
      .select("id, test_name, is_outsourced")
      .in("id", leafIdList.slice(0, 200));
    if (tErr) throw tErr;
    for (const t of tests || []) testsMap[t.id] = t;
  }

  const leafTests = expandRegistrationTests(
    (reg as any).tests || [],
    leafIds,
    testsMap,
  ).map((t: any) => ({
    test_id: t.test_id,
    test_name: t.test_name || testsMap[t.test_id]?.test_name || "",
  }));

  const seen = new Set(leafTests.map((t) => t.test_id));
  for (const id of leafIds) {
    if (seen.has(id)) continue;
    leafTests.push({ test_id: id, test_name: testsMap[id]?.test_name || "" });
  }

  const outsourcedIds = leafTests
    .map((t) => t.test_id)
    .filter((id) => !!testsMap[id]?.is_outsourced)
    .slice(0, 100);
  const hasParamsByTestId: Record<string, boolean> = {};
  if (outsourcedIds.length > 0) {
    const { data: params, error: pErr } = await supabase
      .from("test_parameters")
      .select("test_id")
      .in("test_id", outsourcedIds)
      .eq("is_subheader", false);
    if (pErr) throw pErr;
    for (const id of outsourcedIds) hasParamsByTestId[id] = false;
    for (const p of params || []) {
      if (p?.test_id) hasParamsByTestId[p.test_id] = true;
    }
  }

  return buildPipelineOverview({
    registration: reg as any,
    tubes: (tubes || []) as any[],
    resultRows: (results || []) as any[],
    snips: (snips || []) as any[],
    testsMap,
    leafTests,
    hasParamsByTestId: outsourcedIds.length > 0 ? hasParamsByTestId : undefined,
  });
}

export async function fetchPatientTestPipeline(registrationId: string): Promise<PipelineTestRow[]> {
  if (!registrationId) return [];

  const { data, error } = await supabase.rpc("lims_patient_test_pipeline_status", {
    p_registration_id: registrationId,
  });

  if (!error && data != null) {
    return mapRpcRows(data);
  }

  // RPC missing / schema lag → legacy path so hover still works.
  const msg = String((error as any)?.message || (error as any)?.code || "");
  if (/does not exist|PGRST202|42883/i.test(msg) || (error as any)?.code === "PGRST202") {
    return fetchPatientTestPipelineLegacy(registrationId);
  }
  if (error) throw error;
  return [];
}
